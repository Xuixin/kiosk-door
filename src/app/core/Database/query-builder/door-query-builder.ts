import { RxDoorDocumentType } from '../../schema/door.schema';

// GraphQL Query สำหรับ Pull Door
export const PULL_DOOR_QUERY = `
  query PullDoors($input: DoorPull!) {
    pullDoors(input: $input) {
      documents {
        id
        name
        checkpoint
        client_created_at
        client_updated_at
        server_created_at
        server_updated_at
        deleted
      }
      checkpoint {
        id
        server_updated_at
      }
    }
  }
`;

// GraphQL Mutation สำหรับ Push Door
export const PUSH_DOOR_MUTATION = `
  mutation PushDoors($writeRows: [DoorInputPushRow!]!) {
    pushDoors(input: $writeRows) {
      checkpoint
      client_created_at
      client_updated_at
      id
      server_created_at
      server_updated_at
      deleted
    }
  }
`;

// GraphQL Subscription สำหรับ Stream Door
export const STREAM_DOOR_SUBSCRIPTION = `
  subscription StreamDoor {
    streamDoor {
      documents {
        id
        name
        checkpoint
        client_created_at
        client_updated_at
        server_created_at
        server_updated_at
      }
      checkpoint {
        id
        server_updated_at
      }
    }
  }
`;

// Type definitions สำหรับ Backend
/*
input DoorPull {
  checkpoint: CheckpointInput!
  limit: Int!
}

input CheckpointInput {
  id: String!
  server_updated_at: String!
}

type PullDoorResponse {
  documents: [Door!]!
  checkpoint: Checkpoint!
}

type Checkpoint {
  id: String!
  server_updated_at: String!
}

type DoorInputPushRow {
  newDocumentState: DoorInput!
}

input DoorInput {
  id: String!
  name: String!
  checkpoint: String!
  client_created_at: String!
  client_updated_at: String
  server_created_at: String
  server_updated_at: String
  deleted: Boolean!
}

type Door {
  id: String!
  name: String!
  checkpoint: String!
  client_created_at: String!
  client_updated_at: String
  server_created_at: String
  server_updated_at: String
  deleted: Boolean!
}
*/
