import { useState } from 'react'

function App() {
  const [response, setResponse] = useState<string>('')

  const fetchHello = async () => {
    try {
      const res = await fetch('/api/hello')
      const data = await res.json()
      setResponse(JSON.stringify(data, null, 2))
    } catch (error) {
      setResponse(`Error: ${error}`)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-8">
      <div className="max-w-2xl w-full">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <h1 className="text-4xl font-bold text-gray-800 text-center mb-8">
            Demo Application
          </h1>

          <div className="flex justify-center mb-8">
            <button
              onClick={fetchHello}
              className="px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors duration-200"
            >
              Fetch Hello World
            </button>
          </div>

          {response && (
            <div className="bg-gray-50 rounded-lg p-6 border border-gray-200">
              <h2 className="text-sm font-semibold text-gray-600 mb-2">Response:</h2>
              <pre className="text-sm text-gray-800 whitespace-pre-wrap break-words">
                {response}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
