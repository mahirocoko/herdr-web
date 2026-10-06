import * as React from 'react'
import { Tabs as BaseTabs } from '@base-ui/react/tabs'

export const Tabs = BaseTabs.Root

export interface ITabsListProps extends React.ComponentPropsWithoutRef<
  typeof BaseTabs.List
> {}

export const TabsList = React.forwardRef<HTMLDivElement, ITabsListProps>(
  ({ className, ...props }, ref) => (
    <BaseTabs.List
      ref={ref}
      className={`ui-tabs__list ${className || ''}`.trim()}
      {...props}
    />
  ),
)
TabsList.displayName = 'TabsList'

export interface ITabsTabProps extends React.ComponentPropsWithoutRef<
  typeof BaseTabs.Tab
> {}

export const TabsTab = React.forwardRef<HTMLElement, ITabsTabProps>(
  ({ className, ...props }, ref) => (
    <BaseTabs.Tab
      ref={ref}
      className={`ui-tabs__tab ${className || ''}`.trim()}
      {...props}
    />
  ),
)
TabsTab.displayName = 'TabsTab'

export interface ITabsPanelProps extends React.ComponentPropsWithoutRef<
  typeof BaseTabs.Panel
> {}

export const TabsPanel = React.forwardRef<HTMLDivElement, ITabsPanelProps>(
  ({ className, ...props }, ref) => (
    <BaseTabs.Panel
      ref={ref}
      className={`ui-tabs__panel ${className || ''}`.trim()}
      {...props}
    />
  ),
)
TabsPanel.displayName = 'TabsPanel'

export const TabsIndicator = BaseTabs.Indicator

// Aliases matching standard component libraries
export const TabsTrigger = TabsTab
export const TabsContent = TabsPanel

export default Tabs
