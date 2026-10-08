export type DockerProbe = { isUp: boolean; at: number }

declare module 'claude-code' {
  interface PluginState {
    'mod-pytest-markers': { docker: DockerProbe | null }
  }
}
