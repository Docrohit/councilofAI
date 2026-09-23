# Prepare and release Council

Target/candidate: [environment and revision]. Read deploy_rules.md and
server_info.md. Inspect pipeline triggers before pushing: main can deploy
production today; staging promotion is planned.

Prepare exact diff/revision/artifact, independent review, checks, staging evidence
if available, schema/backup compatibility, active-task/project impact and rollback.
Do not label local tests as staging or YAML environment names as verified gates.

For production obtain owner approval for this reviewable release. If approval
already explicitly covers this candidate/scope, don't ask again. Earlier releases
do not authorize it. Use the approved pipeline and verify its result, running
revision, app/broker health, HTTPS, sanitized logs and affected user flows.
Health alone does not establish a SHA.

On failure report actual activation/rollback state and stop unsafe dependent
steps. No manual server edits or silent DB restore. Report interruptions and
remaining work. Other self-hosted installations do not upgrade automatically.
