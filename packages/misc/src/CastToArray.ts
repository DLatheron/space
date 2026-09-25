export function CastToArray<T>(singleValueOrArray: T | T[]): T[] {
    return Array.isArray(singleValueOrArray) ? singleValueOrArray : [singleValueOrArray];
}
