#!/usr/bin/env zsh
# install.sh - symlink wxsave into ~/.local/bin so it's on PATH.

set -e

REPO_DIR="${0:A:h}"
TARGET="$HOME/.local/bin/wxsave"

mkdir -p "$HOME/.local/bin"

if [[ -L "$TARGET" || -e "$TARGET" ]]; then
  print "[install] removing existing $TARGET"
  rm -f "$TARGET"
fi

ln -s "$REPO_DIR/bin/wxsave" "$TARGET"
print "[install] linked $TARGET -> $REPO_DIR/bin/wxsave"

if ! command -v single-file >/dev/null 2>&1; then
  print "[install] warning: single-file-cli not installed"
  print "          run: npm install -g single-file-cli"
fi

case ":$PATH:" in
  *":$HOME/.local/bin:"*)
    print "[install] ~/.local/bin already on PATH"
    ;;
  *)
    print "[install] warning: ~/.local/bin is NOT on your PATH"
    print "          add this to your shell rc:  export PATH=\"\$HOME/.local/bin:\$PATH\""
    ;;
esac
