param(
  [string]$Namespace = "controlled-data-query-test",
  [string]$ExpectedSigningKid = "",
  [string[]]$AcceptedKids = @(),
  [switch]$SkipUnknownKid
)

$ErrorActionPreference = "Stop"

function Invoke-Kubectl([string[]]$Arguments) {
  & kubectl @Arguments
  if ($LASTEXITCODE -ne 0) { throw "kubectl failed: $($Arguments -join ' ')" }
}

Invoke-Kubectl @("-n", $Namespace, "wait", "--for=condition=Available", "deployment/dsh", "deployment/dic-be-public", "deployment/dic-be-broker", "deployment/dic-fe", "--timeout=180s")
foreach ($externalSecret in @("dsh-runtime", "dic-be-public-runtime", "dic-be-broker-runtime", "dic-be-ddl-runtime")) {
  Invoke-Kubectl @("-n", $Namespace, "wait", "--for=condition=Ready", "externalsecret/$externalSecret", "--timeout=120s")
}
Invoke-Kubectl @("-n", $Namespace, "wait", "--for=condition=Complete", "job/dic-be-ddl", "--timeout=300s")

$requiredPolicies = @(
  "default-deny", "allow-dns-egress", "broker-ingress-from-dsh", "dsh-ingress-from-public",
  "public-ingress-from-controller", "frontend-ingress-from-controller", "public-egress", "dsh-egress", "broker-egress", "ddl-egress"
)
foreach ($policy in $requiredPolicies) { Invoke-Kubectl @("-n", $Namespace, "get", "networkpolicy/$policy") }
Invoke-Kubectl @("-n", "data-platform", "get", "pod", "-l", "app.kubernetes.io/name=tidb")

$images = (& kubectl -n $Namespace get deployment,job -o jsonpath="{..image}") -split '\s+' | Where-Object { $_ }
if ($LASTEXITCODE -ne 0 -or $images.Count -eq 0) { throw "cannot read workload images" }
foreach ($image in $images) {
  if ($image -cnotmatch '^[^@\s]+@sha256:[0-9a-f]{64}$') {
    throw "workload image is not resolved to an exact sha256 digest: $image"
  }
}

Invoke-Kubectl @("-n", $Namespace, "exec", "deployment/dic-be-public", "--", "python", "-c", "import urllib.request; e=None`ntry: urllib.request.urlopen('http://127.0.0.1:8000/v1/internal/data-query/query')`nexcept Exception as x: e=x`nassert getattr(e,'code',None)==404")
Invoke-Kubectl @("-n", $Namespace, "exec", "deployment/dic-be-broker", "--", "python", "-c", "import urllib.request; e=None`ntry: urllib.request.urlopen('http://127.0.0.1:8000/v1/data-query/conversations')`nexcept Exception as x: e=x`nassert getattr(e,'code',None)==404")
Invoke-Kubectl @("-n", $Namespace, "exec", "deployment/dsh", "--", "node", "-e", "fetch('http://127.0.0.1:3081/healthz/ready').then(r=>{if(!r.ok)process.exit(1)})")

if ($ExpectedSigningKid -or $AcceptedKids.Count -gt 0) {
  if (-not $ExpectedSigningKid -or $AcceptedKids.Count -eq 0) {
    throw "ExpectedSigningKid and AcceptedKids must be supplied together"
  }
  $acceptedCsv = $AcceptedKids -join ","
  $code = @'
const { createHmac, randomUUID } = require('node:crypto');
const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const ring = JSON.parse(process.env.DATA_AID_QUERY_ASSERTION_KEY_RING ?? '{}');
const active = process.env.DATA_AID_QUERY_ASSERTION_ACTIVE_KID;
if (active !== process.env.EXPECTED_SIGNING_KID) throw new Error(`live active kid ${active} does not match expected ${process.env.EXPECTED_SIGNING_KID}`);
const kids = process.env.EXPECTED_ACCEPTED_KIDS.split(',').filter(Boolean);
const now = Math.floor(Date.now() / 1000);
(async () => {
  for (const kid of kids) {
    const key = ring[kid];
    if (typeof key !== 'string') throw new Error(`live DSH key ring does not contain expected accepted kid ${kid}`);
    const unsigned = `${enc({alg:'HS256',typ:'JWT',kid})}.${enc({iss:'dsh',aud:'dic-be:data-query',sub:'verify-only',jti:randomUUID(),iat:now,exp:now+30,conversationId:'verify-conversation',turnId:randomUUID()})}`;
    const token = `${unsigned}.${createHmac('sha256',key).update(unsigned).digest('base64url')}`;
    const response = await fetch('http://dic-be-broker:8000/v1/internal/data-query/query',{method:'POST',headers:{'content-type':'application/json','x-dsh-principal-assertion':token},body:'{}'});
    const body = await response.text();
    if (body.includes('DQ_ASSERTION_INVALID')) throw new Error(`broker rejected configured kid ${kid}`);
  }
})().catch(error => { console.error(error.message); process.exit(1); });
'@
  Invoke-Kubectl @("-n", $Namespace, "exec", "deployment/dsh", "--", "env", "EXPECTED_SIGNING_KID=$ExpectedSigningKid", "EXPECTED_ACCEPTED_KIDS=$acceptedCsv", "node", "-e", $code)
}

if (-not $SkipUnknownKid) {
  $code = @'
const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const token = `${enc({alg:'HS256',typ:'JWT',kid:'definitely-unknown'})}.${enc({iss:'dsh',aud:'dic-be:data-query',sub:'verify-only',jti:'verify-unknown-kid',iat:now,exp:now+30,conversationId:'verify-conversation',turnId:'verify-turn'})}.invalid`;
fetch('http://dic-be-broker:8000/v1/internal/data-query/query',{method:'POST',headers:{'content-type':'application/json','x-dsh-principal-assertion':token},body:'{}'}).then(async r=>{const body=await r.text();if(r.ok||!body.includes('DQ_ASSERTION_INVALID'))process.exit(1)}).catch(()=>process.exit(1));
'@
  Invoke-Kubectl @("-n", $Namespace, "exec", "deployment/dsh", "--", "node", "-e", $code)
}

Write-Host "controlled-data-query cluster verification passed"
