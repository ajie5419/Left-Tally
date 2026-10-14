import {
  BusinessErrorCode,
  BusinessException,
  roundQuantity,
  isEqualQuantity,
  QUANTITY_EPSILON,
  type WorkshopConservationBreakdown,
} from '@gc/contracts';

/**
 * Workshop quantity conservation theorem authoritative enforcement.
 * Dispatched = InProgress + Delivered + Scrapped + PendingDisposal.
 */
export function assertWorkshopQuantityConservation(
  breakdown: WorkshopConservationBreakdown,
  epsilon: number = QUANTITY_EPSILON,
): void {
  const parts = [
    breakdown.dispatched,
    breakdown.inProgress,
    breakdown.delivered,
    breakdown.scrapped,
    breakdown.pendingDisposal,
  ];

  for (const part of parts) {
    if (!Number.isFinite(part) || part < 0) {
      throw new BusinessException(
        BusinessErrorCode.VALIDATION_FAILED,
        `Negative or invalid quantity in conservation check: ${String(part)}`,
        { breakdown },
      );
    }
  }

  const downstreamSum = roundQuantity(
    breakdown.inProgress +
      breakdown.delivered +
      breakdown.scrapped +
      breakdown.pendingDisposal,
  );
  const targetDispatched = roundQuantity(breakdown.dispatched);

  if (!isEqualQuantity(targetDispatched, downstreamSum, epsilon)) {
    throw new BusinessException(
      BusinessErrorCode.QUANTITY_MISMATCH,
      `Workshop quantity conservation violation: dispatched (${String(targetDispatched)}) != inProgress (${String(breakdown.inProgress)}) + delivered (${String(breakdown.delivered)}) + scrapped (${String(breakdown.scrapped)}) + pendingDisposal (${String(breakdown.pendingDisposal)}) [sum = ${String(downstreamSum)}]`,
      {
        expected: targetDispatched,
        actual: downstreamSum,
        delta: roundQuantity(targetDispatched - downstreamSum),
        breakdown,
      },
    );
  }
}
