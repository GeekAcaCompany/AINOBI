// SPDX-License-Identifier: AGPL-3.0-only
// The response envelope shape shared by the backend and every frontend. The
// serializer that produces it (with its Python-parity quirks — UTC Z suffixes,
// microsecond padding, naive wall-clock columns, non-ASCII escaping) stays
// inside the backend's HTTP layer; this module is only the contract.

export interface SuccessEnvelope<T> {
  code: 0;
  message: 'OK';
  success: true;
  data: T;
}

export interface ErrorEnvelope {
  code: number;
  message: string;
  success: false;
  data?: unknown;
}

export type Envelope<T> = SuccessEnvelope<T> | ErrorEnvelope;
