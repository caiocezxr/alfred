declare module '@echogarden/espeak-ng-emscripten' {
  type Worker = { set_voice(name: string): number; synthesize_ipa(text: string): { code: number; ipa: string } }
  type Instance = { eSpeakNGWorker: new () => Worker }
  const factory: (opts?: { getPreloadedPackage?: (name: string, size: number) => ArrayBuffer; locateFile?: (p: string) => string; print?: (s: string) => void; printErr?: (s: string) => void }) => Promise<Instance>
  export default factory
}
