import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { CurrentProfile } from "../common/decorators";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { ProfileGuard } from "../common/guards/profile.guard";
import { MyListService } from "./my-list.service";

@Controller("my-list")
@UseGuards(JwtAuthGuard, ProfileGuard)
export class MyListController {
  constructor(private readonly myList: MyListService) {}

  @Get()
  list(@CurrentProfile() profileId: string) {
    return this.myList.list(profileId);
  }

  @Post(":titleId")
  @HttpCode(204)
  add(@CurrentProfile() profileId: string, @Param("titleId") titleId: string) {
    return this.myList.add(profileId, titleId);
  }

  @Delete(":titleId")
  @HttpCode(204)
  remove(
    @CurrentProfile() profileId: string,
    @Param("titleId") titleId: string,
  ) {
    return this.myList.remove(profileId, titleId);
  }
}
