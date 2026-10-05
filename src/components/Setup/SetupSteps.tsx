// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import { CheckIcon } from '@heroicons/react/24/solid';

interface CurrentStep {
  stepNumber: number;
  description: string;
  active?: boolean;
  completed?: boolean;
  /** Kept for compatibility with Seerr callers. */
  isLastStep?: boolean;
}

/** One pill in the setup progress list (`<ol className="sh-steps">`). */
const SetupSteps = ({
  stepNumber,
  description,
  active = false,
  completed = false,
}: CurrentStep) => {
  return (
    <li
      className={completed ? 'done' : undefined}
      aria-current={active ? 'step' : undefined}
    >
      {completed ? (
        <CheckIcon className="h-4 w-4" aria-hidden="true" />
      ) : (
        <span className="font-mono">{stepNumber}</span>
      )}
      {description}
    </li>
  );
};

export default SetupSteps;
