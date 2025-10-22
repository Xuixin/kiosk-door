import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

export interface GraphQLResponse<T = any> {
  data?: T;
  errors?: Array<{
    message: string;
    locations?: Array<{
      line: number;
      column: number;
    }>;
    path?: string[];
  }>;
}

export interface Door {
  id: string;
  name: string;
  description?: string;
  checkpoint?: string;
  client_created_at?: string;
  client_updated_at?: string;
  server_created_at?: string;
  server_updated_at?: string;
  deleted?: boolean;
}

export interface PullDoorsResponse {
  pullDoors: {
    documents: Door[];
    checkpoint: {
      id: string;
      server_updated_at: string;
    };
  };
}

@Injectable({
  providedIn: 'root',
})
export class GraphQLService {
  private readonly apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  /**
   * Execute GraphQL query
   */
  async query<T = any>(
    query: string,
    variables?: Record<string, any>,
  ): Promise<any> {
    try {
      const response = await this.http
        .post<GraphQLResponse<T>>(this.apiUrl, {
          query,
          variables,
        })
        .toPromise();

      if (response?.errors && response.errors.length > 0) {
        console.error('GraphQL errors:', response.errors);
        throw new Error(response.errors[0].message);
      }

      return response || { data: null as T };
    } catch (error) {
      console.error('GraphQL query error:', error);
      throw error;
    }
  }

  /**
   * Pull doors from GraphQL API
   */
  async pullDoors(): Promise<Door[]> {
    const query = `
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

    const variables = {
      input: {
        checkpoint: {
          id: '',
          server_updated_at: '0',
        },
        limit: 100, // Get all doors
      },
    };

    try {
      const response = await this.query<PullDoorsResponse>(query, variables);

      if (response.data?.pullDoors?.documents) {
        // Filter out deleted doors
        return response.data.pullDoors.documents.filter(
          (door: Door) => !door.deleted,
        );
      }

      return [];
    } catch (error) {
      console.error('Error pulling doors:', error);
      throw error;
    }
  }

  /**
   * Get all doors (simplified query without replication parameters)
   */
  async getAllDoors(): Promise<Door[]> {
    const query = `
      query GetAllDoors {
        doors {
          id
          name
          checkpoint
          client_created_at
          client_updated_at
          server_created_at
          server_updated_at
          deleted
        }
      }
    `;

    try {
      const response = await this.query<{ doors: Door[] }>(query);

      if (response.data?.doors) {
        // Filter out deleted doors
        return response.data.doors.filter((door: Door) => !door.deleted);
      }

      return [];
    } catch (error) {
      console.error('Error getting all doors:', error);
      throw error;
    }
  }
}
