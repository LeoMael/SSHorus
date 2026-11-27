// Lo que SSHorus deja en el servidor al llevar la cuenta de Claude Code. Lo escriben los scripts del motor
// (src-tauri/src/localterm/claude_vps/scripts.rs, que reciben el secreto); aquí se lee y se quita.
// Una prueba comprueba que cada nombre aparece también en el script del motor.

/** Carpeta privada de SSHorus en el servidor (0700). */
export const DIR = "$HOME/.config/sshorus";
/** «Llave de acceso»: la llave (0600). */
export const TOKEN_FILE = `${DIR}/claude-token`;
/** «Llave de acceso»: pone `CLAUDE_CODE_OAUTH_TOKEN` leyendo `TOKEN_FILE` (no lleva la llave). */
export const ENV_FILE = `${DIR}/claude-env.sh`;
/** «Copiar mi sesión»: marca de que la sesión la puso SSHorus. */
export const SESSION_MARK = `${DIR}/claude-session`;
/** «Copiar mi sesión»: la sesión que ya tenía el servidor, para reponerla al quitar la cuenta. */
export const BACKUP_FILE = `${DIR}/claude-credentials-antes.json`;
/** Donde Claude Code guarda la sesión. */
export const CREDS_FILE = "$HOME/.claude/.credentials.json";
/** Lo que se añade a fish. */
export const FISH_FILE = "$HOME/.config/fish/conf.d/sshorus-claude.fish";
/** Marca de la línea añadida a los archivos de inicio de la shell. */
export const RC_MARK = "# SSHorus: cuenta de Claude Code";
/** Archivos de inicio de la shell en los que puede estar esa línea. */
export const RC_FILES = [".bashrc", ".bash_profile", ".zshrc", ".profile"] as const;
