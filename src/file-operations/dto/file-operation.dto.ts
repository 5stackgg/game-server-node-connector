import { IsString, IsNotEmpty, IsOptional } from "class-validator";

export class ListDirectoryDto {
  @IsString()
  @IsNotEmpty()
  basePath: string;

  @IsString()
  @IsOptional()
  path?: string;
}

export class ReadFileDto {
  @IsString()
  @IsNotEmpty()
  basePath: string;

  @IsString()
  @IsNotEmpty()
  path: string;
}

export class CreateDirectoryDto {
  @IsString()
  @IsNotEmpty()
  basePath: string;

  @IsString()
  @IsNotEmpty()
  dirPath: string;
}

export class DeleteItemDto {
  @IsString()
  @IsNotEmpty()
  basePath: string;

  @IsString()
  @IsNotEmpty()
  path: string;
}

export class MoveItemDto {
  @IsString()
  @IsNotEmpty()
  basePath: string;

  @IsString()
  @IsNotEmpty()
  sourcePath: string;

  @IsString()
  @IsNotEmpty()
  destPath: string;
}

export class RenameItemDto {
  @IsString()
  @IsNotEmpty()
  basePath: string;

  @IsString()
  @IsNotEmpty()
  oldPath: string;

  @IsString()
  @IsNotEmpty()
  newPath: string;
}

export class GetFileStatsDto {
  @IsString()
  @IsNotEmpty()
  basePath: string;

  @IsString()
  @IsNotEmpty()
  path: string;
}

export class UploadFileDto {
  @IsString()
  @IsNotEmpty()
  basePath: string;

  @IsString()
  @IsNotEmpty()
  filePath: string;
}

export class WriteFileDto {
  @IsString()
  @IsNotEmpty()
  basePath: string;

  @IsString()
  @IsNotEmpty()
  filePath: string;

  @IsString()
  content: string;
}

export interface FileItemResponse {
  name: string;
  path: string;
  type: string;
  size: number;
  modified: Date;
  isDirectory: boolean;
}

export interface FileListResponse {
  items: FileItemResponse[];
  currentPath: string;
}

export interface FileContentResponse {
  content: string;
  path: string;
  size: number;
}

export interface FileStatsResponse {
  name: string;
  path: string;
  size: number;
  modified: Date;
  isDirectory: boolean;
  isFile: boolean;
}
