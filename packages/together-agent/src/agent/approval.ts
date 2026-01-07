import { PendingApproval, ApprovalResponse } from "./types";

// Store pending approvals at module level
// Key: approvalId, Value: approval state
const pendingApprovals = new Map<string, PendingApproval>();

// Generate unique approval ID
export function generateApprovalId(): string {
  return `approval-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Create approval request and wait for response
export function createApprovalRequest(
  approvalId: string,
  timeoutMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Set up timeout
    const timeoutId = setTimeout(() => {
      pendingApprovals.delete(approvalId);
      const timeoutSeconds = timeoutMs / 1000;
      reject(new Error(`This tool requires confirmation to proceed. The user who requested this tool did not confirm within ${timeoutSeconds} seconds.`));
    }, timeoutMs);

    // Store pending approval
    pendingApprovals.set(approvalId, {
      resolve,
      reject,
      timeoutId,
      timestamp: Date.now(),
    });
  });
}

// Resolve approval request (called by approval endpoint)
export function resolveApproval(response: ApprovalResponse): boolean {
  const pending = pendingApprovals.get(response.approvalId);

  if (!pending) {
    return false; // Approval not found or already resolved
  }

  // Clear timeout
  clearTimeout(pending.timeoutId);

  // Remove from pending map
  pendingApprovals.delete(response.approvalId);

  // Resolve/reject the promise directly (it's being awaited in tool context)
  if (response.approved) {
    pending.resolve();
  } else {
    pending.reject(
      new Error(
        "This tool requires confirmation to proceed. The user that requested this tool declined to proceed."
      )
    );
  }

  return true;
}
