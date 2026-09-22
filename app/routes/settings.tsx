import { useLocation, useNavigate, useOutletContext } from 'react-router'
import SettingsView from '@/components/settings-view.tsx'
import type { IAppOutletContext } from '../root.tsx'

const SettingsRoute = () => {
  const {
    push,
    viewportGeometry,
    shouldRestoreMenuFocusRef
  } = useOutletContext<IAppOutletContext>()
  const navigate = useNavigate()
  const location = useLocation()

  const handleBackFromSettings = () => {
    shouldRestoreMenuFocusRef.current = true
    if (location.state && (location.state as Record<string, unknown>).appOwned) {
      navigate(-1)
    } else {
      navigate('/', { replace: true })
    }
  }

  const appStyle = viewportGeometry
    ? {
        height: `${viewportGeometry.height}px`,
        transform:
          viewportGeometry.offsetTop > 0
            ? `translateY(${viewportGeometry.offsetTop}px)`
            : undefined
      }
    : undefined

  return (
    <div
      className="herdr-app"
      style={appStyle}
      data-keyboard-open={viewportGeometry?.isKeyboardOpen ? 'true' : undefined}
    >
      <SettingsView push={push} onBack={handleBackFromSettings} />
    </div>
  )
}

export default SettingsRoute
