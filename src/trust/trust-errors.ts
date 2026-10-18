import { ConflictException, HttpStatus } from '@nestjs/common';

const conflict = (error: string) => () =>
  new ConflictException({ status: HttpStatus.CONFLICT, error });

/** Not completed, or the review window is over. */
export const reviewNotAllowed = conflict('reviewNotAllowed');

/** The order already has a review (a deleted one counts). */
export const reviewExists = conflict('reviewExists');

/** This cook already reported this review. */
export const reviewAlreadyReported = conflict('reviewAlreadyReported');

/** Wrong status, the window is over, or a report of the order is still open. */
export const issueNotAllowed = conflict('issueNotAllowed');

/** An admin already resolved or rejected this report. */
export const issueClosed = conflict('issueClosed');

/** The chat is read-only: the order closed more than the window ago. */
export const messagingClosed = conflict('messagingClosed');
