/** Minimal ambient declarations for Node.js globals used in this example. */
declare namespace NodeJS {
  interface ProcessEnv {
    OSGP_ROUTER_URL?: string
    [key: string]: string | undefined
  }
}

declare const process: { env: NodeJS.ProcessEnv }
