/**
 * Merges Word JSON (project info) with Excel flats array
 * into a single unified JSON structure.
 */
export function mergeProjectData(wordJson, excelFlats) {
    return excelFlats.map(flat => ({
        ...wordJson,
        ...flat
    }));
}
