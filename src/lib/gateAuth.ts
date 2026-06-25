/** 兼容旧 import：登录态与 authSession 共用 */
export {
  AUTH_LS_KEY as GATE_LS_KEY,
  AUTH_REQUIRED_EVENT as GATE_AUTH_REQUIRED_EVENT,
  isStoredAuthenticated as isStoredAuthorized,
  isAuthError as isGateAuthError,
  notifyAuthRequired as notifyGateAuthRequired,
} from './authSession';
