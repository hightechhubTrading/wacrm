#!/usr/bin/env bash
# Installed as /docker/wacrm/update.sh. Keeps server-owned environment and routing.
set -Eeuo pipefail
cd "$(dirname "$(readlink -f "$0")")"
exec 9>.deploy.lock
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 1; }
branch=${WACRM_BRANCH:-feat/ctwa-conversions}
repo=https://github.com/hightechhubTrading/wacrm.git
revision=$(git ls-remote --exit-code "$repo" "refs/heads/$branch" | cut -f1)
[[ $revision =~ ^[a-f0-9]{40}$ ]] || { echo 'Could not resolve deployment branch.' >&2; exit 1; }
export WACRM_GIT_REF=$revision
# Save the running version before a build can replace its image tag.
previous=$(docker inspect --format '{{.Image}}' wacrm)
if ! docker image inspect "$previous" >/dev/null 2>&1; then
  # A manual rebuild/prune may have removed the running image's old digest.
  # Accept its replacement only when the compiled build IDs match exactly.
  reference=$(docker inspect --format '{{.Config.Image}}' wacrm)
  running_build=$(docker exec wacrm cat /app/.next/BUILD_ID)
  image_build=$(docker run --rm --entrypoint cat "$reference" /app/.next/BUILD_ID)
  [[ $running_build == "$image_build" ]] || { echo 'Running image unavailable; cannot prepare a verified rollback.' >&2; exit 1; }
  previous=$(docker image inspect --format '{{.Id}}' "$reference")
  docker tag "$previous" wacrm:rollback
else
  docker tag "$previous" wacrm:rollback
fi
echo "Building $branch at $revision"
if ! docker compose build --builder wacrm-builder --pull --build-arg SOURCE_COMMIT="$revision" wacrm; then
  docker buildx stop wacrm-builder
  exit 1
fi
docker buildx stop wacrm-builder
candidate="wacrm-candidate-$$"
envfile=$(mktemp .candidate-env.XXXXXX)
chmod 600 "$envfile"
cleanup() {
  docker rm -f "$candidate" >/dev/null 2>&1 || true
  unlink "$envfile" 2>/dev/null || true
}
trap cleanup EXIT
docker inspect wacrm | python3 -c 'import sys,json; print("\n".join(json.load(sys.stdin)[0]["Config"]["Env"]))' > "$envfile"
docker run -d --name "$candidate" --network hth_default --memory 768m --cpus 1 --env-file "$envfile" wacrm:latest >/dev/null
check_container() {
  docker exec -i "$1" node <<'JS'
(async()=>{for(let i=0;i<45;i++){try{const r=await fetch('http://127.0.0.1:3000/login',{signal:AbortSignal.timeout(3000)});if(r.status===200){for(const path of ['/api/whatsapp/calls','/api/whatsapp/calls/audio-config']){const response=await fetch('http://127.0.0.1:3000'+path,{signal:AbortSignal.timeout(5000)});if(response.status!==401)throw Error(path+' auth check failed');}const browser=await require('playwright').chromium.launch();try{const page=await browser.newPage();await page.setContent('<p>Deployment PDF check</p>');const pdf=await page.pdf();if(pdf.subarray(0,4).toString()!=='%PDF')throw Error('PDF check failed');}finally{await browser.close();}return;}}catch{}await new Promise(r=>setTimeout(r,1000));}throw Error('Application did not become healthy');})().catch(e=>{console.error(e.message);process.exit(1)});
JS
}
check_container "$candidate"
cleanup
backup="backups/update-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup"
chmod 700 "$backup"
cp docker-compose.yml "$backup/docker-compose.yml"
chmod 600 "$backup/docker-compose.yml"
# Calls must finish before replacing the app that owns their signaling.
docker exec -i wacrm node <<'JS'
(async()=>{const r=await fetch(process.env.NEXT_PUBLIC_SUPABASE_URL+'/rest/v1/whatsapp_calls?select=id&state=in.(connecting,active)&limit=1',{headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY},signal:AbortSignal.timeout(15000)});const calls=await r.json();if(!r.ok||!Array.isArray(calls))throw Error('Unable to check active calls');if(calls.length)throw Error('A call is active. Retry deployment after it ends.');})().catch(e=>{console.error(e.message);process.exit(1)});
JS
rollback() {
  echo 'Deployment failed. Restoring the previous image.' >&2
  docker tag "$previous" wacrm:latest
  docker compose up -d --no-build --no-deps --force-recreate wacrm
}
trap rollback ERR
docker compose up -d --no-build --no-deps --force-recreate wacrm
check_container wacrm
actual=$(docker exec wacrm cat /app/.next/REVISION)
[[ $actual == "$revision" ]]
trap - ERR
printf 'Deployed %s\nRollback image: wacrm:rollback\n' "$actual"
