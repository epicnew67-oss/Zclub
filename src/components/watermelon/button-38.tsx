import { Button } from '@/components/ui/button';
import { FaBell } from 'react-icons/fa6';

// Copied verbatim from https://registry.watermelon.sh/r/button-38.json
// (only the import path points at this repo's Button).
const Button38 = () => {
  return (
    <Button variant="outline" size="icon" className="relative">
      <FaBell  />
      <span className="absolute -top-0.5 -right-0.5 size-2 animate-bounce rounded-full bg-sky-600 dark:bg-sky-400" />
      <span className="sr-only">Notifications</span>
    </Button>
  );
};

export default Button38;
