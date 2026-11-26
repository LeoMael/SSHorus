// Privilegios del usuario remoto (root / sudo / usuario normal). Base de la pestaña "Administración".
export {
  ADMIN_GROUPS,
  DETECT_COMMAND,
  accountAdmin,
  type AccountAdmin,
  DETECT_TIMEOUT_SECS,
  canElevate,
  parseNoPasswdCheck,
  parsePrivilegeOutput,
  privilegeDescription,
  type ElevationTool,
  type PrivilegeInfo,
  type PrivilegeLevel,
} from "./detect";
export {
  checkSudoNoPassword,
  detectPrivilege,
  getPrivilege,
  initPrivileges,
  refreshPrivilege,
  usePrivilege,
  usePrivileges,
} from "./store";
export { knownAdminFor, useKnownAdmin, type KnownAdmin } from "./knownAdmin";
export {
  computeElevation,
  confirmSudo,
  forgetAllSudo,
  forgetSudo,
  forgetSudoByUser,
  resetStoredSudo,
  setStoredSudo,
  sudoRejected,
  sudoRejectedNotified,
  useStoredSudoState,
  type StoredSudoState,
  getSudoPassword,
  useElevation,
  useHasSudoPassword,
  useSudo,
  type ElevationState,
  type SudoConfirmResult,
} from "./sudo";
export {
  buildExec,
  elevationFailure,
  elevationFailureMessage,
  elevationText,
  wrapScript,
  type Elevation,
  type ElevationFailure,
  type ExecRequest,
} from "./elevate";
export { ElevationError, failureText, readElevated, runScript, succeeded, type ElevatedRead } from "./run";
export { loadStoredSudo, obtainSudoPassword, sudoModeOf, useStoredSudo, type SudoObtainResult } from "./stored";
export {
  defaultSaveChecked,
  otherSessionPasswords,
  resetStoredState,
  storedFailed,
  storedStateAfterConfirm,
  sudoLookupPlan,
  sudoPasswordNeeded,
  noPasswordWhy,
  sudoSourceChanged,
  type NoPasswordWhy,
  type SudoSource,
} from "./lookup";
export {
  askSudoInDialog,
  cancelAllSudoAsks,
  finishSudoAsk,
  sudoPasswordForCommand,
  useSudoAsks,
  type SudoAsk,
} from "./sudoAsk";
