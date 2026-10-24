export type ProjectPerson = {
  id: string
  name: string
  image?: string | null
}

export type ProjectPreview = {
  entities: Array<{
    id: string
    name: string
    positionX: number
    positionY: number
  }>
  relationships: Array<{
    id: string
    sourceEntityId: string
    targetEntityId: string
  }>
}

export type ProjectSummary = {
  id: string
  name: string
  description: string | null
  canDelete: boolean
  isOwner: boolean
  owner: ProjectPerson
  preview: ProjectPreview
}

export type AccountUser = ProjectPerson & { email: string }
