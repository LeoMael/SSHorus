//! Los scripts fijos que reciben la cuenta en el servidor. Son POSIX `sh` y nunca llevan el secreto:
//! llega después, por la entrada estándar, y lo lee `cat`.
//!
//! Qué queda en el servidor (lo mismo describe `src/features/claudeVps/layout.ts`, que lo lee y lo
//! quita; una prueba de la interfaz comprueba que los nombres coinciden):
//! - «Copiar mi sesión»: `~/.claude/.credentials.json` (0600) y la marca `~/.config/sshorus/claude-session`.
//!   Si ya había una sesión, se guarda antes en `~/.config/sshorus/claude-credentials-antes.json` (0600)
//!   y «Quitar» la repone.
//! - «Llave de acceso»: `~/.config/sshorus/claude-token` (0600), `~/.config/sshorus/claude-env.sh`
//!   (pone `CLAUDE_CODE_OAUTH_TOKEN` leyendo ese archivo, sin escribir la llave) y una línea con la marca
//!   `# SSHorus: cuenta de Claude Code` en los archivos de inicio de la shell que existan (o `~/.profile`).
//!   En fish, `~/.config/fish/conf.d/sshorus-claude.fish`.
//! - Las dos: `~/.claude.json` con `hasCompletedOnboarding` solo si no existía (para que Claude Code no
//!   pida iniciar sesión en la bienvenida). No se quita: Claude Code guarda ahí sus ajustes.

use zeroize::Zeroizing;

/// Línea que el script escribe en la salida si guardó una copia de la sesión que ya había en el servidor.
pub const BACKUP_MARK: &str = "backup=1";
/// Código de salida si no llegó nada por la entrada estándar.
pub const EXIT_EMPTY: u32 = 3;

/// Preámbulo común: carpeta privada de SSHorus y bienvenida de Claude Code ya hecha.
const COMMON: &str = r##"set -e
umask 077
d="$HOME/.config/sshorus"
mkdir -p "$d"
chmod 700 "$d"
[ -e "$HOME/.claude.json" ] || printf '%s\n' '{"hasCompletedOnboarding":true}' > "$HOME/.claude.json"
"##;

/// Lee la entrada estándar en `$t` (un temporal junto al destino) y falla si llegó vacía.
const READ_SECRET: &str = r##"cat > "$t"
if [ ! -s "$t" ]; then rm -f "$t"; echo "SSHorus: no llegó nada" >&2; exit 3; fi
chmod 600 "$t"
"##;

const SESSION: &str = r##"c="$HOME/.claude"
mkdir -p "$c"
if [ -f "$c/.credentials.json" ] && [ ! -f "$d/claude-session" ] && [ ! -f "$d/claude-credentials-antes.json" ]; then
  cp "$c/.credentials.json" "$d/claude-credentials-antes.json"
  chmod 600 "$d/claude-credentials-antes.json"
  echo backup=1
fi
t="$c/.credentials.json.sshorus-$$"
"##;

const SESSION_END: &str = r##"mv -f "$t" "$c/.credentials.json"
: > "$d/claude-session"
echo ok=1
"##;

const TOKEN: &str = r##"t="$d/claude-token.$$"
"##;

const TOKEN_END: &str = r##"mv -f "$t" "$d/claude-token"
cat > "$d/claude-env.sh" <<"FIN"
# SSHorus: cuenta de Claude Code (llave de acceso). La quita «Quitar mi cuenta de este servidor».
if [ -r "$HOME/.config/sshorus/claude-token" ]; then
  CLAUDE_CODE_OAUTH_TOKEN=$(cat "$HOME/.config/sshorus/claude-token")
  export CLAUDE_CODE_OAUTH_TOKEN
fi
FIN
m="# SSHorus: cuenta de Claude Code"
line="if [ -r \"\$HOME/.config/sshorus/claude-env.sh\" ]; then . \"\$HOME/.config/sshorus/claude-env.sh\"; fi $m"
add() {
  if [ -f "$1" ] && grep -qF "$m" "$1"; then return 0; fi
  if [ -s "$1" ] && [ -n "$(tail -c 1 "$1")" ]; then echo >> "$1"; fi
  printf '%s\n' "$line" >> "$1"
}
n=0
for f in .bashrc .bash_profile .zshrc .profile; do
  if [ -f "$HOME/$f" ]; then add "$HOME/$f"; n=1; fi
done
case "${SHELL##*/}" in zsh) add "$HOME/.zshrc"; n=1 ;; esac
if [ "$n" = 0 ]; then add "$HOME/.profile"; fi
if [ -d "$HOME/.config/fish" ]; then
  mkdir -p "$HOME/.config/fish/conf.d"
  printf '%s\n' 'if test -r "$HOME/.config/sshorus/claude-token"; set -gx CLAUDE_CODE_OAUTH_TOKEN (cat "$HOME/.config/sshorus/claude-token"); end' > "$HOME/.config/fish/conf.d/sshorus-claude.fish"
fi
echo ok=1
"##;

/// Script que guarda la sesión que llega por la entrada estándar.
pub fn session_script() -> String {
    [COMMON, SESSION, READ_SECRET, SESSION_END].concat()
}

/// Script que guarda la llave que llega por la entrada estándar.
pub fn token_script() -> String {
    [COMMON, TOKEN, READ_SECRET, TOKEN_END].concat()
}

/// El canal exec lleva un arranque corto sin secretos; por la entrada estándar van el script (que `dd`
/// lee exactamente) y después el secreto, que lee el script. Sirve con cualquier shell de login.
pub fn exec_request(script: &str, secret: &[u8]) -> (String, Zeroizing<Vec<u8>>) {
    let script = format!("{script}\n");
    let command = format!("sh -c 'eval \"$(dd bs=1 count={} 2>/dev/null)\"'", script.len());
    let mut stdin = Zeroizing::new(Vec::with_capacity(script.len() + secret.len()));
    stdin.extend_from_slice(script.as_bytes());
    stdin.extend_from_slice(secret);
    (command, stdin)
}
