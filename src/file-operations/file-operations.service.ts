import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import * as fs from "fs/promises";
import { constants } from "fs";
import * as path from "path";
import {
  FileItemResponse,
  FileListResponse,
  FileContentResponse,
  FileStatsResponse,
} from "./dto/file-operation.dto";

@Injectable()
export class FileOperationsService {
  private readonly allowedBasePaths = ["/servers/", "/custom-plugins"];
  private readonly logger = new Logger(FileOperationsService.name);

  private validatePath(basePath: string, userPath: string = ""): string {
    const normalizedBase = path.normalize(basePath);
    const fullPath = path.normalize(path.join(normalizedBase, userPath));

    const isAllowed = this.allowedBasePaths.some((allowed) =>
      normalizedBase.startsWith(allowed),
    );

    if (!isAllowed) {
      this.logger.warn(`Invalid base path attempted: ${normalizedBase}`);
      throw new ForbiddenException("Invalid base path");
    }

    if (!fullPath.startsWith(normalizedBase)) {
      this.logger.warn(
        `Path traversal detected: ${fullPath} does not start with ${normalizedBase}`,
      );
      throw new ForbiddenException("Path traversal detected");
    }

    return fullPath;
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async listDirectory(
    basePath: string,
    relativePath: string = "",
  ): Promise<FileListResponse> {
    const fullPath = this.validatePath(basePath, relativePath);

    if (!(await this.pathExists(fullPath))) {
      throw new NotFoundException(`Directory not found: ${relativePath}`);
    }

    const stats = await fs.stat(fullPath);
    if (!stats.isDirectory()) {
      throw new BadRequestException(`Path is not a directory: ${relativePath}`);
    }

    const entries = await fs.readdir(fullPath);
    const items: FileItemResponse[] = [];

    for (const entry of entries) {
      try {
        const entryPath = path.join(fullPath, entry);
        const entryStats = await fs.stat(entryPath);
        const relativEntryPath = path.join(relativePath, entry);

        items.push({
          name: entry,
          path: relativEntryPath,
          type: entryStats.isDirectory() ? "directory" : "file",
          size: entryStats.size,
          modified: entryStats.mtime,
          isDirectory: entryStats.isDirectory(),
        });
      } catch (error) {
        this.logger.warn(`Error reading entry ${entry}: ${error}`);
      }
    }

    items.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    return {
      items,
      currentPath: relativePath,
    };
  }

  async readFile(
    basePath: string,
    filePath: string,
  ): Promise<FileContentResponse> {
    const fullPath = this.validatePath(basePath, filePath);

    if (!(await this.pathExists(fullPath))) {
      throw new NotFoundException(`File not found: ${filePath}`);
    }

    const stats = await fs.stat(fullPath);
    if (!stats.isFile()) {
      throw new BadRequestException(`Path is not a file: ${filePath}`);
    }

    const content = await fs.readFile(fullPath, "utf8");

    return {
      content,
      path: filePath,
      size: stats.size,
    };
  }

  async createDirectory(basePath: string, dirPath: string): Promise<void> {
    const fullPath = this.validatePath(basePath, dirPath);

    if (await this.pathExists(fullPath)) {
      this.logger.log(`Directory already exists, skipping: ${fullPath}`);
      return;
    }

    await fs.mkdir(fullPath, { recursive: true });
    this.logger.log(`Directory created: ${fullPath}`);
  }

  async deleteFileOrDirectory(
    basePath: string,
    itemPath: string,
  ): Promise<void> {
    const fullPath = this.validatePath(basePath, itemPath);

    if (!(await this.pathExists(fullPath))) {
      throw new NotFoundException(`Path not found: ${itemPath}`);
    }

    const stats = await fs.stat(fullPath);

    if (stats.isDirectory()) {
      await this.deleteDirectoryRecursive(fullPath);
    } else {
      await fs.unlink(fullPath);
    }

    this.logger.log(`Deleted: ${fullPath}`);
  }

  private async deleteDirectoryRecursive(dirPath: string): Promise<void> {
    const entries = await fs.readdir(dirPath);

    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry);
      const stats = await fs.stat(entryPath);

      if (stats.isDirectory()) {
        await this.deleteDirectoryRecursive(entryPath);
      } else {
        await fs.unlink(entryPath);
      }
    }

    await fs.rmdir(dirPath);
  }

  async moveFileOrDirectory(
    basePath: string,
    sourcePath: string,
    destPath: string,
  ): Promise<void> {
    const fullSourcePath = this.validatePath(basePath, sourcePath);
    let fullDestPath = this.validatePath(basePath, destPath);

    if (!(await this.pathExists(fullSourcePath))) {
      throw new NotFoundException(`Source path not found: ${sourcePath}`);
    }

    // If destination is an existing directory, move the source into it
    if (await this.pathExists(fullDestPath)) {
      const destStats = await fs.stat(fullDestPath);
      if (destStats.isDirectory()) {
        const sourceName = path.basename(fullSourcePath);
        fullDestPath = path.join(fullDestPath, sourceName);
        // Re-validate the new destination path
        this.validatePath(basePath, path.join(destPath, sourceName));
      } else {
        throw new BadRequestException(
          `Destination already exists: ${destPath}`,
        );
      }
    }

    // Check if the final destination path already exists
    if (await this.pathExists(fullDestPath)) {
      const sourceName = path.basename(fullSourcePath);
      throw new BadRequestException(
        `Destination already exists: ${path.join(destPath, sourceName)}`,
      );
    }

    const destDir = path.dirname(fullDestPath);
    if (!(await this.pathExists(destDir))) {
      await fs.mkdir(destDir, { recursive: true });
    }

    await fs.rename(fullSourcePath, fullDestPath);
    this.logger.log(`Moved: ${fullSourcePath} -> ${fullDestPath}`);
  }

  async renameFileOrDirectory(
    basePath: string,
    oldPath: string,
    newPath: string,
  ): Promise<void> {
    const fullOldPath = this.validatePath(basePath, oldPath);
    const fullNewPath = this.validatePath(basePath, newPath);

    if (!(await this.pathExists(fullOldPath))) {
      throw new NotFoundException(`Path not found: ${oldPath}`);
    }

    if (await this.pathExists(fullNewPath)) {
      throw new BadRequestException(`Destination already exists: ${newPath}`);
    }

    await fs.rename(fullOldPath, fullNewPath);
    this.logger.log(`Renamed: ${fullOldPath} -> ${fullNewPath}`);
  }

  async uploadFile(
    basePath: string,
    filePath: string,
    buffer: Buffer,
  ): Promise<void> {
    const fullPath = this.validatePath(basePath, filePath);

    const dir = path.dirname(fullPath);
    if (!(await this.pathExists(dir))) {
      await fs.mkdir(dir, { recursive: true });
    }

    await fs.writeFile(fullPath, buffer);
    this.logger.log(`File uploaded: ${fullPath}`);
  }

  async writeTextFile(
    basePath: string,
    filePath: string,
    content: string,
  ): Promise<void> {
    const fullPath = this.validatePath(basePath, filePath);

    const dir = path.dirname(fullPath);
    if (!(await this.pathExists(dir))) {
      await fs.mkdir(dir, { recursive: true });
    }

    await fs.writeFile(fullPath, content, "utf8");
    this.logger.log(`File written: ${fullPath}`);
  }

  async getFileStats(
    basePath: string,
    filePath: string,
  ): Promise<FileStatsResponse> {
    const fullPath = this.validatePath(basePath, filePath);

    if (!(await this.pathExists(fullPath))) {
      throw new NotFoundException(`Path not found: ${filePath}`);
    }

    const stats = await fs.stat(fullPath);

    return {
      name: path.basename(fullPath),
      path: filePath,
      size: stats.size,
      modified: stats.mtime,
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
    };
  }
}
