import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

function ToggleGroup({ className, children, ...props }) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn('group/toggle-group flex w-fit items-center rounded-md border shadow-xs', className)}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Root>
  );
}
function ToggleGroupItem({ className, ...props }) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        'inline-flex h-8 min-w-0 flex-1 shrink-0 cursor-pointer items-center justify-center gap-2 px-3 text-sm font-medium whitespace-nowrap transition-[color,box-shadow] outline-none first:rounded-l-md last:rounded-r-md border-l first:border-l-0 hover:bg-muted hover:text-muted-foreground focus-visible:z-10 focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground',
        className
      )}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
