"""Capture clean source identity for Python release artifacts."""
import hashlib
import subprocess


def source_identity(root, allow_dirty=False):
    """Reject changed tracked files and untracked build inputs unless explicitly building for development."""
    def git(*arguments):
        return subprocess.check_output(["git", *arguments], cwd=root)
    commit = git("rev-parse", "HEAD").decode().strip()
    tracked = git("status", "--porcelain", "--untracked-files=no")
    untracked = git("ls-files", "--others", "--exclude-standard", "--", "src", "scripts", "packages", "web", "distribution", "plugins", ".agents")
    dirty = bool(tracked or untracked)
    if dirty and not allow_dirty:
        raise ValueError("Release wheels require committed source; use --allow-dirty only for unpublished development artifacts")
    return {"sourceCommit":commit,"sourceDirty":dirty,"sourceStatusSha256":hashlib.sha256(tracked+b"\0"+untracked).hexdigest()}
