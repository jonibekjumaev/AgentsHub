import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { isMongoId } from 'class-validator';
import { Message } from '../enums/common.enum';

// Rejects a malformed id argument before it reaches shapeInToMongoObjectId, which would throw a BSONError (B18).
// Same rule (24 hex characters) and message as @IsMongoId on DTO ids; thrown as an array so formatError
// also returns it in extensions.validationErrors (B14)
@Injectable()
export class ObjectIdPipe implements PipeTransform<string, string> {
	transform(value: string, metadata: ArgumentMetadata): string {
		if (!isMongoId(value)) throw new BadRequestException([`${metadata.data} ${Message.INVALID_MONGO_ID}`]);
		return value;
	}
}
