// Runtime data is served by the same-origin insights service.
export const DATA_ORIGIN = '/data';
export const dataUrl = (file) => `${DATA_ORIGIN}/${file}`;
