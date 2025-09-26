import { HasuraConfig } from "./types/HasuraConfig";

export default (): {
  hasura: HasuraConfig;
} => ({
  hasura: {
    adminSecret: process.env.HASURA_GRAPHQL_ADMIN_SECRET as string,
  },
});
