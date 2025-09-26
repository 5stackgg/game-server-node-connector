import { NodeConfig } from "./types/NodeConfig";

export default (): {
  node: NodeConfig;
} => ({
  node: {
    nodeName: process.env.NODE_NAME as string,
  },
});
