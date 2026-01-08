import { useState, useEffect } from 'react'

export interface User {
  id: string
  email: string
  name: string
  picture?: string
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchUser()
  }, [])

  const fetchUser = async () => {
    try {
      const res = await fetch('/auth/user')
      if (res.ok) {
        const userData = await res.json()
        setUser(userData)
      } else {
        setUser(null)
      }
    } catch (err) {
      setError('Failed to fetch user')
      setUser(null)
    } finally {
      setLoading(false)
    }
  }

  const login = () => {
    window.location.href = '/auth/google'
  }

  const logout = async () => {
    try {
      await fetch('/auth/logout')
      setUser(null)
      window.location.reload()
    } catch (err) {
      setError('Failed to logout')
    }
  }

  return { user, loading, error, login, logout }
}
