import { useState, useEffect } from 'react'
import { base44 } from '@/api/base44Client'

interface Task {
  id: string
  title: string
  completed: boolean
}

const Task = base44.entities.Task

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Task.list().then((data: Task[]) => {
      setTasks(data)
      setLoading(false)
    })
  }, [])

  const addTask = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return
    await Task.create({ title: input.trim(), completed: false })
    setInput('')
    setTasks(await Task.list())
  }

  const toggleTask = async (task: Task) => {
    await Task.update(task.id, { completed: !task.completed })
    setTasks(await Task.list())
  }

  const deleteTask = async (id: string) => {
    await Task.delete(id)
    setTasks(await Task.list())
  }

  return (
    <main>
      <h1>Tasks</h1>
      <form onSubmit={addTask}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="New task…"
        />
        <button type="submit">Add</button>
      </form>
      {loading ? (
        <p>Loading…</p>
      ) : (
        <ul>
          {tasks.map((task) => (
            <li key={task.id}>
              <input
                type="checkbox"
                checked={task.completed}
                onChange={() => toggleTask(task)}
              />
              <span style={{ textDecoration: task.completed ? 'line-through' : 'none' }}>
                {task.title}
              </span>
              <button onClick={() => deleteTask(task.id)}>✕</button>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
