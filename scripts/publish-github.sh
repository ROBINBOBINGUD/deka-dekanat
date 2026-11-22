#!/usr/bin/env bash
# Публикует ветку main в открытый репозиторий GitHub.
#
# В локальных коммитах стоит личная почта автора. В открытый репозиторий она попадать не должна,
# поэтому публикуется копия истории, где автор и коммиттер заменены на служебный адрес GitHub
# (<id>+<логин>@users.noreply.github.com). Локальная история не меняется; время коммитов сохраняется.
# Замена детерминированная: повторный запуск даёт те же хеши, поэтому push обычный, без --force.
#
# Запуск из Git Bash:  bash scripts/publish-github.sh [имя-репозитория]
# Нужен выполненный вход: gh auth login
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COPY="$ROOT/../mgimo-dekanat-github"
REPO="${1:-deka-dekanat}"
ID=$(gh api user --jq '.id')
LOGIN=$(gh api user --jq '.login')
EMAIL="${ID}+${LOGIN}@users.noreply.github.com"

if [ ! -d "$COPY/.git" ]; then
  git init -q -b main "$COPY"
  git -C "$COPY" remote add origin "https://github.com/$LOGIN/$REPO.git"
fi
cd "$COPY"
git fetch -q "$ROOT" main
git checkout -q -B main FETCH_HEAD

FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --env-filter "
  export GIT_AUTHOR_NAME='$LOGIN'; export GIT_AUTHOR_EMAIL='$EMAIL'
  export GIT_COMMITTER_NAME='$LOGIN'; export GIT_COMMITTER_EMAIL='$EMAIL'
" -- main > /dev/null
git for-each-ref --format='%(refname)' refs/original | xargs -r -n1 git update-ref -d

# Предохранители: ни личной почты, ни файлов с паролями стенда в том, что уходит наружу.
leaks=$(git log main -p --format=fuller | grep -c -i -E '@gmail\.com|@yandex\.ru|@mail\.ru' || true)
if [ "$leaks" != "0" ]; then echo "Стоп: в истории найдена личная почта ($leaks совпадений)"; exit 1; fi
if git log main --name-only --format= | grep -q -E 'demo-accounts\.prod\.json|СДАЧА\.md|\.env$|\.db$'; then
  echo "Стоп: в истории есть файл, которому нельзя в открытый репозиторий"; exit 1
fi

git push origin main
echo "Опубликовано: https://github.com/$LOGIN/$REPO ($(git rev-list --count main) коммитов, автор $EMAIL)"
