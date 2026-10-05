declare module 'graphql-upload' {
	import { ReadStream } from 'fs';
	import { RequestHandler } from 'express';

	export interface FileUpload {
		filename: string;
		mimetype: string;
		encoding: string;
		createReadStream: () => ReadStream;
	}

	export const GraphQLUpload: any;

	export interface GraphqlUploadExpressOptions {
		maxFieldSize?: number;
		maxFileSize?: number;
		maxFiles?: number;
	}

	export function graphqlUploadExpress(options?: GraphqlUploadExpressOptions): RequestHandler;
}
