#!/bin/bash
# Hook do Claude Code (PostToolUse em Edit|Write): depois de cada edição de código em packages/, roda em segundo
# plano o typecheck e os unitários ligados ao arquivo (vitest related), segundos. Sem build nem webview: não disputa
# o dist/ com os testes do VS Code (spec 03, "Quando cada suíte roda"). Falhou: sai com 2 e a saída vai para o Claude.
# Edições em rajada rodam os testes uma vez só, depois da última.
set -u
root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
file=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')

case "$file" in
  "$root"/packages/*) ;;
  *) exit 0 ;;
esac
case "$file" in
  */node_modules/* | */dist/* | */out-test/*) exit 0 ;;
  *.ts | *.tsx | *.mjs | *.cjs | *.js | *.css | *.json | *.html) ;;
  *) exit 0 ;;
esac

state="$root/node_modules/.cache/claude-test-hook"
mkdir -p "$state"
stamp="$(date +%s%N)"
echo "$stamp" >"$state/last-edit"
# Espera a rajada acabar: se outra edição chegou nesse meio tempo, ela roda os testes
sleep 4
[ "$(cat "$state/last-edit")" = "$stamp" ] || exit 0

exec 9>"$state/lock"
flock 9
[ "$(cat "$state/last-edit")" = "$stamp" ] || exit 0

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh" >/dev/null
  nvm use >/dev/null 2>&1 || true
fi
cd "$root"
if output=$(npm run --silent typecheck 2>&1 && npx vitest related --run --passWithNoTests "$file" 2>&1); then
  exit 0
fi
{
  echo "typecheck ou unitários falharam depois da edição de ${file#"$root"/}:"
  echo "$output" | grep -vE '^\s*$|MESA: error' | tail -60
} >&2
exit 2
