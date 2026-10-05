// STREAM(SV3): implement — recompute per-track presence → Media.status
// (AVAILABLE / PARTIALLY_AVAILABLE / back to UNKNOWN when files disappear) and
// flip requests to COMPLETED when their scope is fully present.
// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
class AvailabilitySync {
  public running = false;

  async run(): Promise<void> {
    return;
  }

  public cancel(): void {
    this.running = false;
  }
}

const availabilitySync = new AvailabilitySync();
export default availabilitySync;
