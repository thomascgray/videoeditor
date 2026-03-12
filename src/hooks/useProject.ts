import { useReducer, useCallback, useEffect, useRef } from 'react'
import type { Project, ProjectAction } from '../types'
import { saveProject, loadProject } from '../lib/projectStorage'

type UndoableState = {
  past: Project[]
  present: Project
  future: Project[]
  /** Snapshot saved on first transient update, used for undo entry on commit */
  transientSnapshot: Project | null
}

function projectReducer(state: UndoableState, action: ProjectAction): UndoableState {
  if (action.type === 'UNDO') {
    if (state.past.length === 0) return state
    const previous = state.past[state.past.length - 1]
    return {
      past: state.past.slice(0, -1),
      present: previous,
      future: [state.present, ...state.future],
      transientSnapshot: null,
    }
  }

  if (action.type === 'REDO') {
    if (state.future.length === 0) return state
    const next = state.future[0]
    return {
      past: [...state.past, state.present],
      present: next,
      future: state.future.slice(1),
      transientSnapshot: null,
    }
  }

  if (action.type === 'UPDATE_OBJECT_TRANSIENT') {
    const newProject = applyAction(state.present, {
      type: 'UPDATE_OBJECT',
      objectId: action.objectId,
      updates: action.updates,
    })
    if (newProject === state.present) return state
    return {
      ...state,
      present: newProject,
      transientSnapshot: state.transientSnapshot ?? state.present,
    }
  }

  if (action.type === 'COMMIT_TRANSIENT') {
    if (!state.transientSnapshot) return state
    return {
      past: [...state.past.slice(-49), state.transientSnapshot],
      present: state.present,
      future: [],
      transientSnapshot: null,
    }
  }

  const newProject = applyAction(state.present, action)
  if (newProject === state.present) return state

  return {
    past: [...state.past.slice(-49), state.present],
    present: newProject,
    future: [],
    transientSnapshot: null,
  }
}

function applyAction(project: Project, action: ProjectAction): Project {
  switch (action.type) {
    case 'SET_PROJECT':
      return action.project

    case 'SET_NAME':
      return { ...project, name: action.name }

    case 'ADD_OBJECTS':
      return { ...project, objects: [...project.objects, ...action.objects] }

    case 'REMOVE_OBJECT':
      return { ...project, objects: project.objects.filter((o) => o.id !== action.objectId) }

    case 'UPDATE_OBJECT':
      return {
        ...project,
        objects: project.objects.map((o) =>
          o.id === action.objectId ? { ...o, ...action.updates } : o,
        ),
      }

    case 'DUPLICATE_OBJECT': {
      const idx = project.objects.findIndex((o) => o.id === action.objectId)
      if (idx === -1) return project
      const original = project.objects[idx]
      const dupe = {
        ...original,
        id: crypto.randomUUID(),
        name: original.name + ' (copy)',
        startTime: original.startTime + original.duration,
      }
      const objects = [...project.objects]
      objects.splice(idx + 1, 0, dupe)
      return { ...project, objects }
    }

    default:
      return project
  }
}

export function useProject() {
  const [state, dispatch] = useReducer(projectReducer, null, () => ({
    past: [],
    present: loadProject(),
    future: [],
    transientSnapshot: null,
  }))

  // Auto-save (debounced)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => {
      saveProject(state.present)
    }, 1000)
    return () => clearTimeout(saveTimeoutRef.current)
  }, [state.present])

  const canUndo = state.past.length > 0
  const canRedo = state.future.length > 0

  const undo = useCallback(() => dispatch({ type: 'UNDO' }), [])
  const redo = useCallback(() => dispatch({ type: 'REDO' }), [])

  return {
    project: state.present,
    dispatch,
    canUndo,
    canRedo,
    undo,
    redo,
  }
}
