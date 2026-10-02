#!/bin/bash
#
# Removes superseded container images from this node, so old versions stop
# filling /var/lib/rancher/k3s/agent. Run daily by ImagePruneService.
#
# Removed, when no container on the node uses them (running, exited or
# created):
# - images that no longer hold a tag. A re-pull of :latest (or another channel
#   tag) moves the tag to the new build and leaves the previous one behind
#   untagged.
# - non-5stack images built before a version of the same image that a
#   container does use (cert-manager v1.17.1 once v1.17.2 is running). Those
#   keep their tag after a version bump. A newer version pulled ahead of
#   switching to it is kept.
#
# A 5stack image that still holds a tag is always kept, running or not. That
# keeps the current game-server / game-streamer images, which are usually
# idle, and :v<version> pins ready for the next match. Superseded pins keep
# their tag too, so they pile up until kubelet's disk-pressure image GC removes
# them. Pinned images are never touched.
#
# One case looks exactly like a superseded version: an image deployed by
# digest (name@sha256:...) that no container uses. It is pruned and pulled
# again the next time it is used.

set -o pipefail

if ! command -v crictl >/dev/null 2>&1; then
  echo "crictl not found"
  exit 1
fi

# --timeout because removing a multi-GB image waits for its snapshots to be
# deleted, which can take longer than crictl's 2s default.
CRICTL=(crictl --runtime-endpoint "${CONTAINER_RUNTIME_ENDPOINT:-unix:///containerd.sock}" --timeout 120s)

ERRORS="$(mktemp)"
trap 'rm -f "$ERRORS"' EXIT

# crictl's last error line, so a failure in the logs says why.
why() {
  local line
  line="$(tail -n 1 "$ERRORS" 2>/dev/null)"
  if [ -n "$line" ]; then
    printf ': %s' "$line"
  fi
}

# Every image a container on this node still references. The refs are plain
# sha256 ids / digests, so grep is enough.
list_in_use() {
  local containers
  if ! containers="$("${CRICTL[@]}" ps -a -o json 2>"$ERRORS")" || ! grep -q '"containers"' <<<"$containers"; then
    return 1
  fi
  grep -oE '"(imageRef|imageId|image)": *"[^"]+"' <<<"$containers" | sed -E 's/^"[^"]+": *"//; s/"$//' | sort -u
  return 0
}

# When the image was built, in seconds since the epoch.
built_at() {
  local created
  created="$("${CRICTL[@]}" inspecti -o go-template --template '{{.info.imageSpec.created}}' "$1" 2>/dev/null)" &&
    [ -n "$created" ] && date -d "$created" +%s 2>/dev/null
}

# Images are listed before containers: a container created in between then
# shows up in the container list, so its image is never removed from under it.
# `images -v` prints one field per line (ID / RepoTags / RepoDigests / Pinned).
if ! IMAGES="$("${CRICTL[@]}" images -v 2>"$ERRORS")" || ! grep -q '^ID: ' <<<"$IMAGES"; then
  echo "could not list images$(why)"
  exit 1
fi

if ! IN_USE="$(list_in_use)"; then
  echo "could not list containers$(why)"
  exit 1
fi

# One line per candidate: its id, its refs (id and digests) and, for a tagged
# non-5stack image, the in-use images of the same repository. The in-use list
# reaches awk as a file, not on the command line, so its size has no argv
# limit.
if ! STALE="$(
  awk '
    function repo(ref) {
      sub(/@.*/, "", ref)
      sub(/:[^:\/]*$/, "", ref)
      return ref
    }
    FILENAME == ARGV[1] { if ($0 != "") used[$0] = 1; next }
    /^ID: /          { n++; id[n] = substr($0, 5); next }
    /^RepoTags: /    { t = substr($0, 11); if (t !~ /<none>/) tags[n] = tags[n] " " t; next }
    /^RepoDigests: / { digests[n] = digests[n] " " substr($0, 14); next }
    /^Pinned: true/  { pinned[n] = 1; next }
    END {
      for (i = 1; i <= n; i++) {
        in_use[i] = (id[i] in used)
        k = split(digests[i], d, " ")
        for (j = 1; j <= k; j++) if (d[j] in used) in_use[i] = 1
        if (!in_use[i]) continue
        k = split(tags[i] " " digests[i], r, " ")
        for (j = 1; j <= k; j++) repo_in_use[repo(r[j])] = repo_in_use[repo(r[j])] " " id[i]
      }
      for (i = 1; i <= n; i++) {
        if (pinned[i] || in_use[i]) continue
        if (tags[i] == "") { print id[i] "\t" id[i] digests[i] "\t"; continue }
        if (index(tags[i] " " digests[i], "ghcr.io/5stackgg/")) continue
        siblings = ""
        k = split(tags[i], r, " ")
        for (j = 1; j <= k; j++) siblings = siblings repo_in_use[repo(r[j])]
        if (siblings != "") print id[i] "\t" id[i] digests[i] "\t" siblings
      }
    }
  ' <(printf '%s\n' "$IN_USE") <(printf '%s\n' "$IMAGES")
)"; then
  echo "could not work out which images to remove"
  exit 1
fi

if [ -z "$STALE" ]; then
  echo "no superseded images"
  exit 0
fi

removed=0
attempted=0
while IFS=$'\t' read -r -u 3 id refs siblings; do
  [ -n "$id" ] || continue

  if [ -n "$siblings" ]; then
    built="$(built_at "$id")" || continue
    older=false
    for sibling in $siblings; do
      if sibling_built="$(built_at "$sibling")" && [ "$sibling_built" -gt "$built" ]; then
        older=true
        break
      fi
    done
    "$older" || continue
  fi

  # Space the removals out: containerd deletes the snapshots in its own
  # process, so pacing is what keeps a large prune from hogging the disk
  # while match servers are running.
  [ "$attempted" -eq 0 ] || sleep 5
  attempted=$((attempted + 1))

  # Checked again right before the removal, since containerd removes an image
  # even while a container uses it.
  if ! in_use="$(list_in_use)"; then
    echo "skipped $id (could not list containers$(why))"
    continue
  fi
  still_used=false
  for ref in $refs; do
    if grep -qxF -- "$ref" <<<"$in_use"; then
      still_used=true
    fi
  done
  if "$still_used"; then
    echo "skipped $id (now in use)"
    continue
  fi

  if error="$("${CRICTL[@]}" rmi "$id" 2>&1 >/dev/null)"; then
    echo "removed $id"
    removed=$((removed + 1))
  else
    # The runtime could not remove it right now - leave it for the next run.
    echo "skipped $id (removal failed: ${error##*$'\n'})"
  fi
done 3<<<"$STALE"

echo "removed $removed superseded image(s)"
