// SPDX-License-Identifier: AGPL-3.0-only
import { object, number, boolean } from 'yup';

/**
 * Pagination Information Interface
 */
export interface PaginationInfo {
  /** Current Page */
  page_number: number;
  /** Page Size */
  page_size: number;
  /** Total Count */
  total_count: number;
  /** Total Pages */
  total_pages: number;
  /** Has Next Page */
  has_next_page: boolean;
  /** Has Previous Page */
  has_previous_page: boolean;
}

/**
 * Paginated Response Interface
 */
export interface PaginatedResponse<T> {
  /** Data */
  data: T[];
  /** Pagination Info */
  pagination: PaginationInfo;
}

export const paginationInfoSchema = object({
  page_number: number().integer().min(1).required(),
  page_size: number().integer().min(1).required(),
  total_count: number().integer().min(0).required(),
  total_pages: number().integer().min(0).required(),
  has_next_page: boolean().required(),
  has_previous_page: boolean().required(),
});
