import { Button } from '@/common/components/ui/button';

export function ChangeWorkflowButton({
  enabled,
  pending,
  onChange,
}: {
  enabled: boolean;
  pending: boolean;
  onChange: () => void;
}) {
  return (
    <Button type="button" variant="outline" size="sm" disabled={!enabled || pending} onClick={onChange}>
      换一个
    </Button>
  );
}
