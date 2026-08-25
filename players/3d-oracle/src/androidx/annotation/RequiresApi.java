package androidx.annotation;
import java.lang.annotation.*;
@Retention(RetentionPolicy.SOURCE)
public @interface RequiresApi { int value() default 0; }
