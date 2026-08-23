/**
 * A tolerated anomaly. Data on the source, never a console write and never a
 * callback: one channel, assertable in tests with no spies.
 *
 * Generic over the code so a driver can publish a CLOSED union of the anomalies
 * its format actually has — `unknown-encoding` means nothing to a COPC reader —
 * while every consumer that only wants to display warnings can take the open
 * form and stay format-agnostic.
 */
export interface PointCloudWarning<Code extends string = string> {
  readonly code: Code;
  /**
   * Where the anomaly is: a JSON path into the manifest
   * (`attributes[5].size`), or a node name / URL for a hierarchy warning.
   */
  readonly path: string;
  readonly message: string;
}
