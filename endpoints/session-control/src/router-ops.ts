export interface RouterMessage {
  type: string;
  [key: string]: unknown;
}

export interface RouterResponse {
  type: string;
  success: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface PermissionCheckResult {
  allowed: boolean;
  missing?: string[];
  error?: string;
}

export const ROUTER_OPS = {
  ANNOUNCE_ROUTE: 'announce.route',
  CONTROL_ADD_PROMPT: 'control.add_prompt',
  SESSION_LIST: 'session.list',
  SESSION_READ: 'session.read',
  ROUTE_LIST: 'route.list',
  ADMIN_REQUEST: 'admin.request',
} as const;

export type RouterOp = (typeof ROUTER_OPS)[keyof typeof ROUTER_OPS];

export const REQUIRED_PERMISSIONS: RouterOp[] = [
  ROUTER_OPS.ANNOUNCE_ROUTE,
  ROUTER_OPS.CONTROL_ADD_PROMPT,
  ROUTER_OPS.SESSION_LIST,
  ROUTER_OPS.SESSION_READ,
  ROUTER_OPS.ROUTE_LIST,
];
