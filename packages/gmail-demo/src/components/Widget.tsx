import { useState, useEffect, useRef } from 'react'

interface WidgetProps {
  widgetId: string
  code: string
  onApprovalRequest: (payload: any) => Promise<string> // Returns approvalId
}

// Define available widget components
const Container = ({ children }: any) => (
  <div className="flex flex-col gap-4">
    {children}
  </div>
)

const Input = ({ value, onChange, placeholder, type = 'text', disabled = false }: any) => (
  <input
    type={type}
    value={value || ''}
    onChange={(e) => onChange?.(e.target.value)}
    placeholder={placeholder}
    disabled={disabled}
    className="w-full px-3 py-2 mb-4 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
  />
)

const Textarea = ({ value, onChange, placeholder, rows = 3, disabled = false }: any) => (
  <textarea
    value={value || ''}
    onChange={(e) => onChange?.(e.target.value)}
    placeholder={placeholder}
    rows={rows}
    disabled={disabled}
    className="w-full px-3 py-2 mb-4 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100 disabled:cursor-not-allowed resize-y"
  />
)

const Button = ({ children, onClick, disabled = false, variant = 'primary' }: any) => {
  const baseClasses = 'px-4 py-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
  const variantClasses = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:hover:bg-indigo-600',
    secondary: 'bg-gray-200 text-gray-800 hover:bg-gray-300 disabled:hover:bg-gray-200',
    danger: 'bg-red-600 text-white hover:bg-red-700 disabled:hover:bg-red-600',
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${baseClasses} ${variantClasses[variant as keyof typeof variantClasses] || variantClasses.primary}`}
    >
      {children}
    </button>
  )
}

const Text = ({ children, variant = 'body' }: any) => {
  const variantClasses = {
    heading: 'text-2xl font-bold text-gray-900',
    subheading: 'text-lg font-semibold text-gray-800',
    body: 'text-base text-gray-700',
    caption: 'text-sm text-gray-600',
  }

  return (
    <p className={variantClasses[variant as keyof typeof variantClasses] || variantClasses.body}>
      {children}
    </p>
  )
}

const Card = ({ children }: any) => (
  <div className="bg-white rounded-lg shadow-md p-4 border border-gray-200">
    {children}
  </div>
)

const Spinner = () => (
  <div className="flex items-center justify-center">
    <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
  </div>
)

const Alert = ({ children, variant = 'info' }: any) => {
  const variantClasses = {
    info: 'bg-blue-50 border-blue-200 text-blue-800',
    success: 'bg-green-50 border-green-200 text-green-800',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    error: 'bg-red-50 border-red-200 text-red-800',
  }

  return (
    <div className={`p-4 rounded-md border ${variantClasses[variant as keyof typeof variantClasses] || variantClasses.info}`}>
      {children}
    </div>
  )
}

// Component registry
const COMPONENTS = {
  Container,
  Input,
  Textarea,
  Button,
  Text,
  Card,
  Spinner,
  Alert,
}

// h() function for rendering components
function h(component: any, props: any, ...children: any[]) {
  const Component = typeof component === 'string' ? COMPONENTS[component as keyof typeof COMPONENTS] : component
  if (!Component) {
    console.error(`Unknown component: ${component}`)
    return null
  }

  // Extract key and ref (special React props that shouldn't be passed to component)
  const { key, ref, ...componentProps } = props || {}

  return (
    <Component key={key} ref={ref} {...componentProps}>
      {children.filter(c => c !== null && c !== undefined)}
    </Component>
  )
}

export function Widget({ widgetId, code, onApprovalRequest }: WidgetProps) {
  const [state, setState] = useState<any>({})
  const [error, setError] = useState<string | null>(null)
  const [isExecutingTool, setIsExecutingTool] = useState(false)
  const widgetFunctionRef = useRef<any>(null)
  const initializedRef = useRef(false)

  // Create codeTools proxy
  const codeTools = new Proxy({}, {
    get: (_, toolName: string) => {
      return async (...args: any[]) => {
        setIsExecutingTool(true)
        let approvalToken: string | undefined

        try {
          // Attempt to call the tool
          const executeCall = async (token?: string) => {
            const response = await fetch('/api/agent/code-tool', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                toolName,
                args: args[0] || {},
                approvalToken: token,
              }),
            })

            return await response.json()
          }

          let data = await executeCall()

          // Handle approval flow
          if (data.requiresApproval) {
            console.log(`🚨 Approval required for ${toolName}`, data.approvalPrompt)

            // Request approval from parent component
            approvalToken = await onApprovalRequest({
              toolName,
              args: args[0] || {},
              prompt: data.approvalPrompt,
            })

            console.log(`✅ Approval granted for ${toolName}, retrying with token:`, approvalToken)

            // Retry with approval token
            data = await executeCall(approvalToken)
          }

          if (!data.success) {
            throw new Error(data.error || 'Tool execution failed')
          }

          return data.result
        } catch (error: any) {
          console.error(`Tool execution error (${toolName}):`, error)
          throw error
        } finally {
          setIsExecutingTool(false)
        }
      }
    },
  })

  // Initialize widget function and state
  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true

    try {
      // Execute the transformed code to get the Widget function
      // The code already has "return Widget;" appended at the end
      const widgetFunction = new Function(
        'state',
        'setState',
        'h',
        'codeTools',
        ...Object.keys(COMPONENTS),
        code
      )

      // Call the function to get the Widget constructor
      // Pass null for state/setState as we only need to extract Widget.initialState
      const Widget = widgetFunction(
        null,
        null,
        h,
        codeTools,
        ...Object.values(COMPONENTS)
      )

      if (typeof Widget !== 'function') {
        throw new Error('Widget code did not return a function')
      }

      // Extract and set initial state
      if (Widget.initialState) {
        setState(Widget.initialState)
      } else {
        console.warn('Widget does not define initialState')
        setState({})
      }

      // Store the widget function for rendering
      widgetFunctionRef.current = Widget
    } catch (err: any) {
      console.error('Failed to initialize widget:', err)
      setError(err.message || 'Failed to initialize widget')
    }
  }, [code, widgetId])

  // Custom setState that merges state
  const handleSetState = (updates: any) => {
    setState((prevState: any) => ({
      ...prevState,
      ...updates,
    }))
  }

  // Render the widget
  if (error) {
    return (
      <Alert variant="error">
        <Text variant="subheading">Widget Error</Text>
        <Text variant="caption">{error}</Text>
      </Alert>
    )
  }

  if (!widgetFunctionRef.current) {
    return <Spinner />
  }

  try {
    const WidgetComponent = widgetFunctionRef.current
    const element = WidgetComponent({ state, setState: handleSetState })

    return element
  } catch (err: any) {
    return (
      <Alert variant="error">
        <Text variant="subheading">Widget Render Error</Text>
        <Text variant="caption">{err.message || 'Failed to render widget'}</Text>
      </Alert>
    )
  }
}
