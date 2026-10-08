declare module "diff" {
  export function createTwoFilesPatch(
    fromFile: string,
    toFile: string,
    fromContent: string,
    toContent: string,
    oldFileName?: string,
    newFileName?: string,
  ): string;
  export function applyPatch(
    source: string,
    patch: string,
    options?: { fuzzFactor?: number; autoConvertLineEndings?: boolean },
  ): string | false;
  export class Diff {
    diff(oldString: string, newString: string, options?: { timeout?: number }): string;
  }
}
