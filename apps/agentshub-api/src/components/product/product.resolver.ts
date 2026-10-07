import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { ProductService } from './product.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { MemberType } from '../../libs/enums/member.enum';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import type { ObjectId } from '../../libs/types/common';
import { UseGuards } from '@nestjs/common';
import { Products, Product } from '../../libs/dto/product/product';
import {
	CreatorProductsInquiry,
	AllProductsInquiry,
	ProductsInquiry,
	ProductInput,
} from '../../libs/dto/product/product.input';
import { OrdinaryInquiry } from '../../libs/dto/common.input';
import { WithoutGuard } from '../auth/guards/without.guard';
import { shapeInToMongoObjectId } from '../../libs/config';
import { ProductUpdate } from '../../libs/dto/product/product.update';
import { AuthGuard } from '../auth/guards/auth.guard';

@Resolver()
export class ProductResolver {
	constructor(private readonly productService: ProductService) {}

	@Roles(MemberType.CREATOR)
	@UseGuards(RolesGuard)
	@Mutation(() => Product)
	public async createProduct(
		@Args('input') input: ProductInput,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Product> {
		console.log('Mutation: createProduct');
		input.memberId = memberId;
		return await this.productService.createProduct(input);
	}

	@UseGuards(WithoutGuard)
	@Query(() => Product)
	public async getProduct(
		@Args('productId') input: string,
		@AuthMember('_id') memberId: ObjectId,
		@AuthMember('memberType') memberType: MemberType,
	): Promise<Product> {
		console.log('Query: getProduct');
		const productId = shapeInToMongoObjectId(input);
		return await this.productService.getProduct(memberId, memberType, productId);
	}

	@Roles(MemberType.CREATOR)
	@UseGuards(RolesGuard)
	@Mutation(() => Product)
	public async updateProduct(
		@Args('input') input: ProductUpdate,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Product> {
		console.log('Mutation: updateProduct');
		input._id = shapeInToMongoObjectId(input._id);
		return await this.productService.updateProduct(memberId, input);
	}

	@UseGuards(WithoutGuard)
	@Query(() => Products)
	public async getProducts(
		@Args('input') input: ProductsInquiry,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Products> {
		console.log('Query: getProducts');
		return await this.productService.getProducts(memberId, input);
	}

	@UseGuards(AuthGuard)
	@Query(() => Products)
	public async getFavorities(
		@Args('input') input: OrdinaryInquiry,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Products> {
		console.log('Query: getFavorities');
		return await this.productService.getFavorities(memberId, input);
	}

	@UseGuards(AuthGuard)
	@Query(() => Products)
	public async getVisited(
		@Args('input') input: OrdinaryInquiry,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Products> {
		console.log('Query: getVisited');
		return await this.productService.getVisited(memberId, input);
	}

	@Roles(MemberType.CREATOR)
	@UseGuards(RolesGuard)
	@Query(() => Products)
	public async getCreatorProducts(
		@Args('input') input: CreatorProductsInquiry,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Products> {
		console.log('Query: getCreatorProducts');
		return await this.productService.getCreatorProducts(memberId, input);
	}

	@UseGuards(AuthGuard)
	@Mutation(() => Product)
	public async likeTargetProduct(
		@Args('productId') input: string,
		@AuthMember('_id') memberId: ObjectId,
	): Promise<Product> {
		console.log('Mutation: likeTargetProduct');
		const likeRefId = shapeInToMongoObjectId(input);
		return await this.productService.likeTargetProduct(memberId, likeRefId);
	}

	/** ADMIN */

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Query(() => Products)
	public async getAllProductsByAdmin(@Args('input') input: AllProductsInquiry): Promise<Products> {
		console.log('Query: getAllProductsByAdmin');
		return await this.productService.getAllProductsByAdmin(input);
	}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => Product)
	public async updateProductByAdmin(@Args('input') input: ProductUpdate): Promise<Product> {
		console.log('Mutation: updateProductByAdmin');
		input._id = shapeInToMongoObjectId(input._id);
		return await this.productService.updateProductByAdmin(input);
	}

	@Roles(MemberType.ADMIN)
	@UseGuards(RolesGuard)
	@Mutation(() => Product)
	public async removeProductByAdmin(@Args('productId') input: string): Promise<Product> {
		console.log('Mutation: removeProductByAdmin');
		const productId = shapeInToMongoObjectId(input);
		return await this.productService.removeProductByAdmin(productId);
	}
}
