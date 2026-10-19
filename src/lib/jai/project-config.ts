/**
 * `jacket.toml`, the one project config of the Jacket tools: `[format]` holds
 * jaifmt's settings and `[lint]` jailint's. In each folder it wins over the
 * legacy `jaifmt.toml` and `jailint.toml`, which imported workspaces may still
 * carry and are still read.
 */
export const PROJECT_CONFIG_PATH = 'jacket.toml';

/** Default `jacket.toml` for new workspaces. */
export const projectConfigStarter = `# Settings for the Jacket tools. A jacket.toml in a subfolder
# applies instead of this one to the files under it.

# The Format button (Shift+Alt+F). The values below are jaifmt's defaults.
[format]
indent_width = 4           # spaces per block level, 1-16
# case_indent = 4          # \`case\` lines inside \`if x == {\`, 0-16; default indent_width
# case_body_indent = 4     # statements under a \`case\`, 0-16; default indent_width
max_blank_lines = 2        # longest run of blank lines kept, 0-100
brace_style = "same_line"  # "same_line" joins a lone \`{\` or \`else\` to the line above; "preserve"

# jailint, whose findings show in the editor.
# Levels: "allow" (off), "warn" or "deny".
[lint.rules]
# Off by default outside the playground:
float_equality = "warn"  # \`==\` or \`!=\` between two computed floats
lossy_xx = "warn"        # \`xx\` that narrows a number to a smaller type
# Turn any rule off by name, e.g.:
# unused_parameter = "allow"
`;

export const isProjectConfig = (path: string) =>
  path === PROJECT_CONFIG_PATH || path.endsWith(`/${PROJECT_CONFIG_PATH}`);
