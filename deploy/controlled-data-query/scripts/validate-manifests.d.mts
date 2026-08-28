export interface DeploymentValidationResult {
  readonly resourceCount: number
  readonly networkPolicyCount: number
}

export function assertPinnedImage(image: string): void
export function assertResolvedImage(image: string): void
export function validateDeploymentArtifacts(root?: string): Promise<DeploymentValidationResult>
