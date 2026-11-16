# Find and install skills

Tiller can search skills.sh and install a skill into your global `~/.agents/skills` folder or a project's `.agents/skills` folder. Review the skill preview and audit results before installing. Tiller downloads files pinned to a GitHub commit and does not run installation scripts. Skills may contain scripts that your agents can run; review them before use.

Skills installed by Tiller are tracked in `.tiller-skills.json` so they can be updated or uninstalled. Tiller only uninstalls skills present in that lockfile.
