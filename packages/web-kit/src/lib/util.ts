// SPDX-License-Identifier: AGPL-3.0-only
export default {
  unixTimestamp() {
    return Math.floor(Date.now() / 1000);
  },

  timestamp() {
    return Date.now();
  },

  /**
   * Clean query parameters, removing invalid values
   * @param query query parameter object
   * @returns the cleaned query parameter object
   */
  cleanQueryParams(query: { [key: string]: any }): { [key: string]: any } {
    const cleaned: { [key: string]: any } = {};

    for (const key in query) {
      const value = query[key];

      // Filter out invalid values
      if (this.isValidQueryValue(value)) {
        cleaned[key] = value;
      }
    }

    return cleaned;
  },

  /**
   * Check whether a value is a valid query parameter value
   * @param value the value to check
   * @returns whether it is valid
   */
  isValidQueryValue(value: any): boolean {
    // null and undefined are invalid
    if (value === null || value === undefined) {
      return false;
    }

    // Empty strings are invalid
    if (value === "") {
      return false;
    }

    // Empty arrays are invalid
    if (Array.isArray(value) && value.length === 0) {
      return false;
    }

    // Empty objects are invalid
    if (
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
    ) {
      return false;
    }

    return true;
  },

  buildQueryString(query: { [key: string]: any }) {
    // Clean the query parameters first
    const cleanedQuery = this.cleanQueryParams(query);

    let queryString = "";
    for (let key in cleanedQuery) {
      const value = cleanedQuery[key];
      queryString += `${key}=${encodeURIComponent(value)}&`;
    }
    if (queryString) queryString = `?${queryString.slice(0, -1)}`;
    return queryString;
  },

  downloadFile(url: string, filename?: string) {
    const a = document.createElement("a");
    a.href = url;
    if (filename) a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  },
};
